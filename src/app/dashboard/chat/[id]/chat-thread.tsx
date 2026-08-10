"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ChatMessage, avatarColor, initials } from "@/lib/types";
import { baghdadDate, baghdadTime } from "@/lib/time";

// ============================================================
// شاشة المحادثة — بأسلوب رسائل فيسبوك:
//   • رسائلي في جهة، ورسائل الطرف الآخر في الجهة المقابلة.
//   • الرسائل المتتالية من نفس الشخص تُجمَّع بلا تكرار الاسم.
//   • فاصل تاريخ بين الأيام (اليوم / أمس / التاريخ).
//   • تصل الرسالة الجديدة لحظياً بلا تحديث الصفحة (Realtime)،
//     ومعها تحديث دوري كل 15 ثانية كخطة احتياطية.
//   • Enter يرسل، و Shift+Enter ينزل سطراً جديداً.
// ============================================================
export default function ChatThread({
  conversationId,
  initialMessages,
  myUserId,
  canWrite,
  isGroup,
}: {
  conversationId: string;
  initialMessages: ChatMessage[];
  myUserId: string;
  canWrite: boolean;
  isGroup: boolean;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // إضافة رسالة مع منع التكرار (قد تصل مرتين: من الإرسال ومن البثّ)
  const addMessage = useCallback((m: ChatMessage) => {
    setMessages((prev) =>
      prev.some((x) => x.id === m.id)
        ? prev
        : [...prev, m].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
    );
  }, []);

  // جلب كامل (خطة احتياطية إن لم يعمل البثّ اللحظي)
  const reload = useCallback(async () => {
    const { data } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(300);
    if (data) setMessages(data as ChatMessage[]);
  }, [supabase, conversationId]);

  // تعليم المحادثة كمقروءة (يُطفئ العدّاد في القائمة والجرس)
  const markRead = useCallback(async () => {
    await supabase.rpc("mark_conversation_read", { cid: conversationId });
  }, [supabase, conversationId]);

  useEffect(() => {
    markRead().then(() => router.refresh());

    const channel = supabase
      .channel(`chat-${conversationId}-${Math.random().toString(36).slice(2)}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          addMessage(payload.new as ChatMessage);
          markRead();
        }
      )
      .subscribe();

    const timer = setInterval(reload, 15000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(timer);
    };
  }, [supabase, conversationId, addMessage, reload, markRead, router]);

  // النزول لآخر رسالة كلما وصلت رسالة
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;

    setSending(true);
    setError(null);

    const { data, error } = await supabase
      .from("messages")
      .insert({ conversation_id: conversationId, sender_id: myUserId, body })
      .select()
      .single();

    setSending(false);

    if (error) {
      setError("تعذّر الإرسال: " + error.message);
      return;
    }
    setText("");
    if (data) addMessage(data as ChatMessage);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const today = baghdadDate();
  const yesterday = baghdadDate(Date.now() - 86400000);

  function dateSeparator(iso: string): string {
    const d = baghdadDate(iso);
    if (d === today) return "اليوم";
    if (d === yesterday) return "أمس";
    return d;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
      {/* الرسائل */}
      <div ref={boxRef} className="flex-1 space-y-1 overflow-y-auto bg-gray-50/60 p-4">
        {messages.length === 0 && (
          <p className="py-10 text-center text-sm text-gray-400">
            لا توجد رسائل بعد — اكتب أول رسالة 👋
          </p>
        )}

        {messages.map((m, i) => {
          const mine = m.sender_id === myUserId;
          const prev = messages[i - 1];
          const newDay = !prev || baghdadDate(prev.created_at) !== baghdadDate(m.created_at);
          // تجميع الرسائل المتتالية من نفس الشخص
          const grouped =
            !newDay && prev && prev.sender_id === m.sender_id &&
            new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60000;

          return (
            <div key={m.id}>
              {newDay && (
                <div className="my-4 flex items-center gap-3">
                  <span className="h-px flex-1 bg-gray-200" />
                  <span className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-gray-500 shadow-sm">
                    {dateSeparator(m.created_at)}
                  </span>
                  <span className="h-px flex-1 bg-gray-200" />
                </div>
              )}

              <div className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}>
                {/* صورة رمزية للطرف الآخر (تظهر مع أول رسالة في المجموعة) */}
                {!mine && (
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      grouped ? "invisible" : avatarColor(m.sender_name ?? "؟")
                    }`}
                  >
                    {initials(m.sender_name ?? "؟")}
                  </span>
                )}

                <div className={`max-w-[75%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                  {/* اسم المُرسِل في المجموعات فقط */}
                  {!mine && isGroup && !grouped && (
                    <span className="mb-0.5 px-1 text-[11px] font-semibold text-gray-500">
                      {m.sender_name}
                    </span>
                  )}

                  <div
                    className={`whitespace-pre-wrap break-words px-3.5 py-2 text-[15px] leading-relaxed shadow-sm ${
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

                  <span className="mt-0.5 px-1 text-[10px] text-gray-400" dir="ltr">
                    {baghdadTime(m.created_at)}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* مربّع الكتابة */}
      {canWrite ? (
        <div className="border-t border-gray-200 bg-white p-3">
          {error && (
            <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="اكتب رسالة... (Enter للإرسال)"
              className="max-h-32 min-h-[44px] flex-1 resize-y rounded-2xl border border-gray-300 px-4 py-2.5 text-[15px] focus:border-brand-500 focus:outline-none"
            />
            <button
              onClick={send}
              disabled={sending || !text.trim()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white transition hover:bg-brand-700 disabled:opacity-40"
              aria-label="إرسال"
            >
              {/* أيقونة الإرسال تشير لليمين، ونحن بواجهة عربية فنعكسها */}
              <span className="material-symbols-outlined -scale-x-100 text-[20px]">send</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="border-t border-gray-200 bg-gray-50 p-4 text-center text-sm text-gray-500">
          هذه قناة إعلانات — الكتابة فيها للإدارة فقط.
        </div>
      )}
    </div>
  );
}
