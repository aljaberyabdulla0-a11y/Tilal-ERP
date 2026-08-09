import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getPeople } from "@/lib/people";
import {
  ConversationRow,
  avatarColor,
  initials,
  timeAgo,
} from "@/lib/types";
import StartChat from "./start-chat";

// ============================================================
// المحادثات — قائمة كل محادثاتي (مثل قائمة الرسائل في فيسبوك).
// الترتيب: الأحدث رسالةً أولاً، وغير المقروء بخط عريض وشارة زرقاء.
// ============================================================
export default async function ChatPage() {
  const supabase = await createClient();
  const [user, admin, people] = await Promise.all([
    getCurrentUser(),
    isAdmin(),
    getPeople(),
  ]);

  // دالة واحدة في القاعدة ترجع القائمة جاهزة (اسم الطرف الآخر + غير المقروء)
  const { data, error } = await supabase.rpc("my_conversations");
  const conversations = (data ?? []) as ConversationRow[];

  // كل الزملاء ما عداي
  const colleagues = people.filter((p) => p.user_id !== user?.id);

  return (
    <main className="p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-brand-900">المحادثات</h1>
          <p className="mt-1 text-gray-500">
            راسل زملاءك مباشرة — والإدارة تقدر ترسل إعلاناً لكل الموظفين.
          </p>
        </div>
      </header>

      {error && (
        <div className="mb-6 rounded-2xl bg-amber-50 p-5 text-amber-800">
          لم تُفعَّل المحادثات بعد في قاعدة البيانات — شغّل ملف{" "}
          <b dir="ltr">sql/030_chat.sql</b> في Supabase.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* قائمة المحادثات */}
        <section className="glass-card overflow-hidden lg:col-span-2">
          {conversations.length === 0 ? (
            <p className="p-8 text-center text-sm text-gray-400">
              لا توجد محادثات بعد — ابدأ واحدة من القائمة المجاورة.
            </p>
          ) : (
            <ul>
              {conversations.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/dashboard/chat/${c.id}`}
                    className="flex items-center gap-3 border-b border-gray-100 px-4 py-3.5 transition last:border-0 hover:bg-brand-50/50"
                  >
                    {/* الصورة الرمزية */}
                    <span
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-bold ${
                        c.is_announcement
                          ? "bg-brand-600 text-white"
                          : avatarColor(c.display_title)
                      }`}
                    >
                      {c.is_announcement ? (
                        <span className="material-symbols-outlined text-[22px]">campaign</span>
                      ) : c.kind === "group" ? (
                        <span className="material-symbols-outlined text-[22px]">groups</span>
                      ) : (
                        initials(c.display_title)
                      )}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span
                          className={`truncate ${
                            c.unread > 0 ? "font-bold text-gray-900" : "font-semibold text-gray-700"
                          }`}
                        >
                          {c.display_title}
                        </span>
                        {c.kind === "group" && !c.is_announcement && (
                          <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">
                            {c.member_count} أعضاء
                          </span>
                        )}
                      </span>
                      <span
                        className={`mt-0.5 block truncate text-sm ${
                          c.unread > 0 ? "font-medium text-gray-700" : "text-gray-400"
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
              ))}
            </ul>
          )}
        </section>

        {/* بدء محادثة جديدة */}
        <StartChat people={colleagues} isAdmin={admin} />
      </div>
    </main>
  );
}
