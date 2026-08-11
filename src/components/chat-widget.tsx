"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  ChatMessage,
  ConversationRow,
  avatarColor,
  initials,
  timeAgo,
} from "@/lib/types";
import { baghdadTime } from "@/lib/time";

// ============================================================
// نافذة المحادثة المنبثقة — فقاعة ثابتة في زاوية الشاشة تفتح
// نافذة صغيرة، تماماً مثل ماسنجر في المتصفح: تقرأ وترد وأنت في أي
// صفحة (العملاء، المهام، المحاسبة…) بلا مغادرتها.
//
// تختفي داخل قسم المحادثات نفسه (/dashboard/chat) لأنها ستكون تكراراً.
//
// كل شيء يمرّ عبر نفس دوال القاعدة المستخدمة في الصفحة الكاملة
// (my_conversations / mark_conversation_read) فلا يوجد منطق مكرّر
// للصلاحيات — حماية الصفوف تحكم الاثنين.
// ============================================================
export default function ChatWidget({
  myUserId,
  isAdmin,
}: {
  myUserId: string;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const supabase = useMemo(() => createClient(), []);

  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ConversationRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  // نحتفظ بالمحادثة المفتوحة في مرجع ليقرأها مستمع البثّ اللحظي
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  const active = rows.find((c) => c.id === activeId) ?? null;
  const unreadTotal = rows.reduce((s, c) => s + (c.unread ?? 0), 0);
  const insideChatPage = pathname.startsWith("/dashboard/chat");

  const reloadRows = useCallback(async () => {
    const { data } = await supabase.rpc("my_conversations");
    if (data) setRows(data as ConversationRow[]);
  }, [supabase]);

  const loadMessages = useCallback(
    async (cid: string) => {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", cid)
        .order("created_at", { ascending: true })
        .limit(100);
      if (data) setMessages(data as ChatMessage[]);
      await supabase.rpc("mark_conversation_read", { cid });
      reloadRows();
    },
    [supabase, reloadRows]
  );

  // العدّاد يعمل دائماً (حتى والنافذة مغلقة) ما لم نكن داخل صفحة المحادثات
  useEffect(() => {
    if (insideChatPage) return;

    reloadRows();

    const channel = supabase
      .channel(`chat-widget-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const m = payload.new as ChatMessage;
          reloadRows();
          // الرسالة تخصّ المحادثة المفتوحة في النافذة → أضفها فوراً
          if (m.conversation_id === activeRef.current) {
            setMessages((prev) =>
              prev.some((x) => x.id === m.id) ? prev : [...prev, m]
            );
            supabase.rpc("mark_conversation_read", { cid: m.conversation_id });
          }
        }
      )
      .subscribe();

    const timer = setInterval(reloadRows, 20000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
    };
  }, [supabase, reloadRows, insideChatPage]);

  // النزول لآخر رسالة
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, activeId]);

  async function openConversation(cid: string) {
    setActiveId(cid);
    setMessages([]);
    setError(null);
    await loadMessages(cid);
  }

  async function send() {
    const body = text.trim();
    if (!body || !activeId || sending) return;

    setSending(true);
    setError(null);

    const { data, error } = await supabase
      .from("messages")
      .insert({ conversation_id: activeId, sender_id: myUserId, body })
      .select()
      .single();

    setSending(false);

    if (error) {
      setError("تعذّر الإرسال: " + error.message);
      return;
    }
    setText("");
    if (data) {
      const m = data as ChatMessage;
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    }
    reloadRows();
  }

  if (insideChatPage) return null;

  const canWrite = !active?.is_announcement || isAdmin;

  return (
    <>
      {/* ===== النافذة ===== */}
      {open && (
        <div className="fixed bottom-24 end-4 z-40 flex h-[460px] w-[min(92vw,360px)] flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl sm:end-6">
          {/* الرأس */}
          <div className="flex items-center gap-2 border-b border-gray-200 bg-brand-600 px-3 py-2.5 text-white">
            {activeId && (
              <button
                onClick={() => setActiveId(null)}
                aria-label="رجوع"
                className="flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-white/20"
              >
                <span className="material-symbols-outlined text-[18px]">
                  arrow_forward
                </span>
              </button>
            )}

            <span className="min-w-0 flex-1 truncate font-bold">
              {active ? active.display_title : "المحادثات"}
            </span>

            {activeId ? (
              <Link
                href={`/dashboard/chat/${activeId}`}
                title="فتح بالحجم الكامل"
                className="flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-white/20"
              >
                <span className="material-symbols-outlined text-[18px]">
                  open_in_full
                </span>
              </Link>
            ) : (
              <Link
                href="/dashboard/chat"
                title="فتح صفحة المحادثات"
                className="flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-white/20"
              >
                <span className="material-symbols-outlined text-[18px]">
                  open_in_full
                </span>
              </Link>
            )}

            <button
              onClick={() => setOpen(false)}
              aria-label="إغلاق"
              className="flex h-7 w-7 items-center justify-center rounded-full transition hover:bg-white/20"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          {/* ===== قائمة المحادثات ===== */}
          {!activeId ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {rows.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-400">
                  لا توجد محادثات بعد.
                  <Link
                    href="/dashboard/chat"
                    className="mt-2 block font-medium text-brand-700 hover:underline"
                  >
                    ابدأ محادثة
                  </Link>
                </div>
              ) : (
                <ul className="p-1.5">
                  {rows.map((c) => (
                    <li key={c.id}>
                      <button
                        onClick={() => openConversation(c.id)}
                        className="flex w-full items-center gap-2.5 rounded-xl p-2 text-start transition hover:bg-gray-100"
                      >
                        <span
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                            c.is_announcement
                              ? "bg-brand-600 text-white"
                              : avatarColor(c.display_title)
                          }`}
                        >
                          {c.is_announcement ? (
                            <span className="material-symbols-outlined text-[18px]">
                              campaign
                            </span>
                          ) : c.kind === "group" ? (
                            <span className="material-symbols-outlined text-[18px]">
                              groups
                            </span>
                          ) : (
                            initials(c.display_title)
                          )}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate text-sm ${
                              c.unread > 0
                                ? "font-bold text-gray-900"
                                : "font-semibold text-gray-700"
                            }`}
                          >
                            {c.display_title}
                          </span>
                          <span
                            className={`block truncate text-xs ${
                              c.unread > 0 ? "font-semibold text-gray-700" : "text-gray-400"
                            }`}
                          >
                            {c.last_message_text ?? "لا توجد رسائل بعد"}
                          </span>
                        </span>

                        <span className="flex shrink-0 flex-col items-end gap-1">
                          <span className="text-[10px] text-gray-400">
                            {c.last_message_at ? timeAgo(c.last_message_at) : ""}
                          </span>
                          {c.unread > 0 && (
                            <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand-600 px-1 text-[10px] font-bold text-white">
                              {c.unread > 9 ? "9+" : c.unread}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            /* ===== المحادثة ===== */
            <>
              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-gray-50/70 p-3">
                {messages.length === 0 ? (
                  <p className="py-8 text-center text-xs text-gray-400">
                    لا توجد رسائل بعد — اكتب أول رسالة 👋
                  </p>
                ) : (
                  messages.map((m) => {
                    const mine = m.sender_id === myUserId;
                    return (
                      <div
                        key={m.id}
                        className={`flex ${mine ? "justify-end" : "justify-start"}`}
                      >
                        <div className="flex max-w-[80%] flex-col">
                          {!mine && active?.kind === "group" && (
                            <span className="mb-0.5 px-1 text-[10px] font-semibold text-gray-500">
                              {m.sender_name}
                            </span>
                          )}
                          <div
                            className={`whitespace-pre-wrap break-words px-3 py-1.5 text-sm leading-relaxed shadow-sm ${
                              mine
                                ? "rounded-2xl rounded-bl-md bg-brand-600 text-white"
                                : "rounded-2xl rounded-br-md border border-gray-200 bg-white text-gray-800"
                            }`}
                          >
                            {m.deleted_at ? (
                              <span className="italic opacity-70">رسالة محذوفة</span>
                            ) : (
                              m.body
                            )}
                          </div>
                          <span
                            className={`mt-0.5 px-1 text-[9px] text-gray-400 ${
                              mine ? "text-end" : "text-start"
                            }`}
                            dir="ltr"
                          >
                            {baghdadTime(m.created_at)}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={bottomRef} />
              </div>

              {canWrite ? (
                <div className="border-t border-gray-200 bg-white p-2">
                  {error && (
                    <p className="mb-1.5 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">
                      {error}
                    </p>
                  )}
                  <div className="flex items-end gap-2">
                    <textarea
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          send();
                        }
                      }}
                      rows={1}
                      placeholder="اكتب رسالة..."
                      className="max-h-24 min-h-[38px] flex-1 resize-y rounded-2xl border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
                    />
                    <button
                      onClick={send}
                      disabled={sending || !text.trim()}
                      aria-label="إرسال"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition hover:bg-brand-700 disabled:opacity-40"
                    >
                      <span className="material-symbols-outlined -scale-x-100 text-[18px]">
                        send
                      </span>
                    </button>
                  </div>
                </div>
              ) : (
                <p className="border-t border-gray-200 bg-gray-50 p-3 text-center text-xs text-gray-500">
                  قناة إعلانات — الكتابة للإدارة فقط.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* ===== الفقاعة ===== */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="المحادثات"
        className="fixed bottom-6 end-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg transition hover:bg-brand-700 sm:end-6"
      >
        <span className="material-symbols-outlined text-[26px]">
          {open ? "close" : "forum"}
        </span>
        {!open && unreadTotal > 0 && (
          <span className="absolute -top-1 start-0 flex h-6 min-w-[24px] items-center justify-center rounded-full border-2 border-white bg-red-600 px-1 text-[11px] font-bold">
            {unreadTotal > 99 ? "99+" : unreadTotal}
          </span>
        )}
      </button>
    </>
  );
}
