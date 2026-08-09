import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { ChatMessage, ConversationRow } from "@/lib/types";
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
    <main className="flex h-[calc(100vh-4rem)] flex-col p-4 lg:h-screen lg:p-6">
      {/* رأس المحادثة */}
      <header className="mb-3 flex items-center gap-3">
        <Link
          href="/dashboard/chat"
          className="flex h-9 w-9 items-center justify-center rounded-xl text-gray-500 transition hover:bg-gray-100 hover:text-brand-700"
          aria-label="رجوع"
        >
          <span className="material-symbols-outlined">arrow_forward</span>
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold text-brand-900">
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
    </main>
  );
}
