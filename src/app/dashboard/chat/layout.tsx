import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getPeople } from "@/lib/people";
import { ConversationRow } from "@/lib/types";
import ChatShell from "./chat-shell";

// ============================================================
// تخطيط قسم المحادثات — القائمة تُبنى هنا مرة واحدة وتبقى ثابتة
// أثناء التنقّل بين المحادثات (هذا ما يعطي إحساس تطبيق ماسنجر:
// لا وميض ولا إعادة تحميل للقائمة عند كل نقرة).
// ============================================================
export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const [user, admin, people] = await Promise.all([
    getCurrentUser(),
    isAdmin(),
    getPeople(),
  ]);

  const { data, error } = await supabase.rpc("my_conversations");
  const conversations = (data ?? []) as ConversationRow[];
  const colleagues = people.filter((p) => p.user_id !== user?.id);

  return (
    <ChatShell
      initialConversations={conversations}
      colleagues={colleagues}
      isAdmin={admin}
      notReady={Boolean(error)}
    >
      {children}
    </ChatShell>
  );
}
