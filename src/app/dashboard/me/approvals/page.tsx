import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ApprovalButtons from "./approval-buttons";

type Pending = {
  id: string;
  workflow_name: string;
  entity_type: string;
  entity_id: string;
  subject_name: string | null;
  title: string;
  amount: number | null;
  days: number | null;
  step_label: string;
  created_at: string;
};

// موافقاتي (sql/153): كل طلب ينتظر قراري الآن — إجازة، دوام، عمل إضافي.
// القاعدة تحسب من هو المُوافِق في كل خطوة؛ هذه الصفحة تعرض ما يخصّني فقط.
export default async function MyApprovalsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_pending_approvals");
  const items = (data ?? []) as Pending[];

  // تفاصيل كل كيان لتُقرأ قبل القرار
  const ids = (t: string) => items.filter((i) => i.entity_type === t).map((i) => i.entity_id);
  const none = ["00000000-0000-0000-0000-000000000000"];
  const [{ data: lvs }, { data: ars }, { data: ots }] = await Promise.all([
    supabase.from("leaves").select("id, reason, leave_type, start_date, end_date, days, hours")
      .in("id", ids("leave").length ? ids("leave") : none),
    supabase.from("attendance_requests").select("id, request_type, reason, check_in_time, check_out_time")
      .in("id", ids("attendance_request").length ? ids("attendance_request") : none),
    supabase.from("overtime_requests").select("id, reason, compensation, hours, work_date")
      .in("id", ids("overtime_request").length ? ids("overtime_request") : none),
  ]);
  const detail = (i: Pending): string | null => {
    if (i.entity_type === "leave") {
      const l = (lvs ?? []).find((x: { id: string }) => x.id === i.entity_id) as { reason: string | null } | undefined;
      return l?.reason ?? null;
    }
    if (i.entity_type === "attendance_request") {
      const a = (ars ?? []).find((x: { id: string }) => x.id === i.entity_id) as
        | { reason: string; check_in_time: string | null; check_out_time: string | null } | undefined;
      if (!a) return null;
      const times = [a.check_in_time?.slice(0, 5), a.check_out_time?.slice(0, 5)].filter(Boolean).join(" ← ");
      return [a.reason, times].filter(Boolean).join(" · ");
    }
    const o = (ots ?? []).find((x: { id: string }) => x.id === i.entity_id) as
      | { reason: string; compensation: string } | undefined;
    return o ? `${o.reason} · تعويض: ${o.compensation}` : null;
  };

  return (
    <main className="min-h-screen bg-gray-50">
      <header className="flex items-center gap-3 border-b bg-white px-6 py-4 shadow-sm">
        <Link href="/dashboard/me" className="text-sm text-gray-500 hover:text-brand-700">← بوابتي</Link>
        <h1 className="text-xl font-bold text-brand-700">موافقاتي</h1>
      </header>
      <section className="space-y-3 p-6">
        {error && <p className="rounded bg-red-50 p-3 text-sm text-red-700">{error.message}</p>}
        {items.length === 0 && (
          <p className="rounded-2xl border border-dashed bg-white p-8 text-center text-sm text-gray-400">لا شيء ينتظر قرارك.</p>
        )}
        {items.map((i) => (
          <div key={i.id} className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-gray-800">{i.title}</p>
                <p className="text-xs text-gray-500">
                  {i.workflow_name} · مرحلتك: {i.step_label} · <span dir="ltr">{i.created_at.slice(0, 10)}</span>
                </p>
                {detail(i) && <p className="mt-1 text-sm text-gray-600">{detail(i)}</p>}
              </div>
              <ApprovalButtons requestId={i.id} />
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}
