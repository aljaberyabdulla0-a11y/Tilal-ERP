import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { MyInterview } from "@/lib/recruitment";
import InterviewFeedback from "./interview-feedback";

// مقابلاتي (sql/150): ما يحتاجه المقيِّم وحده — المرشح والوظيفة والموعد
// والسيرة. لا راتب متوقّع ولا عرض: my_interviews() لا تُرجعهما.
export default async function MyInterviewsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_interviews");
  const items = (data ?? []) as MyInterview[];

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/me" className="text-sm text-gray-500 hover:text-brand-700">← بوابتي</Link>
        <h1 className="text-xl font-bold text-brand-700">مقابلاتي</h1>
      </header>
      <section className="space-y-4 p-6">
        {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error.message}</p>}
        {items.length === 0 && <p className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-gray-400">لا مقابلات مسندة إليك.</p>}
        {items.map((i) => (
          <div key={i.id} className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold text-gray-800">{i.candidate_name}</p>
                <p className="text-xs text-gray-500">
                  {i.opening_title}{i.department_name ? ` — ${i.department_name}` : ""}
                  {i.current_title ? ` · حالياً: ${i.current_title}` : ""}
                </p>
              </div>
              <div className="text-end text-xs text-gray-600">
                <p dir="ltr">{new Date(i.scheduled_at).toLocaleString("en-GB", { timeZone: "Asia/Baghdad", dateStyle: "medium", timeStyle: "short" })}</p>
                <p>{i.mode}{i.location ? ` · ${i.location}` : ""} · جولة {i.round}</p>
              </div>
            </div>
            <InterviewFeedback interview={i} />
          </div>
        ))}
      </section>
    </main>
  );
}
