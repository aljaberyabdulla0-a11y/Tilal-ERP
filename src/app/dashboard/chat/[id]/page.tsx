import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { ChatMessage, ConversationRow, avatarColor, initials } from "@/lib/types";
import ChatThread from "./chat-thread";

// صفحة محادثة واحدة — الرسائل + مربّع الكتابة
export default async function ConversationPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = await createClient();
  const [user, admin] = await Promise.all([getCurrentUser(), isAdmin()]);

  // نأخذ بيانات المحادثة من نفس الدالة التي تبني القائمة
  // (فيها اسم الطرف الآخر جاهزاً وعدد الأعضاء)
  const { data: convs } = await supabase.rpc("my_conversations");
  const conversation = ((convs ?? []) as ConversationRow[]).find(
    (c) => c.id === params.id
  );

  // لست عضواً في هذه المحادثة (أو غير موجودة)
  if (!conversation) notFound();

  const [{ data: msgs }, { data: people }] = await Promise.all([
    supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", params.id)
      .order("created_at", { ascending: true })
      .limit(300),
    supabase.rpc("conversation_people", { cid: params.id }),
  ]);

  const messages = (msgs ?? []) as ChatMessage[];
  const members = (people ?? []) as { user_id: string; name: string }[];

  // قناة الإعلانات: الكتابة للمدير فقط (نفس القاعدة مطبّقة في القاعدة أيضاً)
  const canWrite = !conversation.is_announcement || admin;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* رأس المحادثة — شريط أبيض ثابت مثل ماسنجر */}
      <header className="flex shrink-0 items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
        {/* الرجوع للقائمة — على الجوّال فقط (القائمة ظاهرة دائماً على الشاشات الكبيرة) */}
        <Link
          href="/dashboard/chat"
          className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition hover:bg-gray-100 hover:text-brand-700 lg:hidden"
          aria-label="رجوع"
        >
          <span className="material-symbols-outlined">arrow_forward</span>
        </Link>

        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-bold ${
            conversation.is_announcement
              ? "bg-brand-600 text-white"
              : avatarColor(conversation.display_title)
          }`}
        >
          {conversation.is_announcement ? (
            <span className="material-symbols-outlined text-[20px]">campaign</span>
          ) : conversation.kind === "group" ? (
            <span className="material-symbols-outlined text-[20px]">groups</span>
          ) : (
            initials(conversation.display_title)
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold text-gray-900">
            {conversation.display_title}
          </h1>
          <p className="truncate text-xs text-gray-400">
            {conversation.is_announcement
              ? "قناة إعلانات الإدارة — يكتب فيها المدير ويقرأها الجميع"
              : conversation.kind === "group"
                ? members.map((m) => m.name).join("، ")
                : "محادثة خاصة"}
          </p>
        </div>
      </header>

      <ChatThread
        conversationId={conversation.id}
        initialMessages={messages}
        myUserId={user?.id ?? ""}
        canWrite={canWrite}
        isGroup={conversation.kind === "group"}
      />
    </div>
  );
}
