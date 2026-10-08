import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import ClientFollowUps from "@/components/client-followups";
import TaskSection from "./task-section";
import { SectionTitle } from "../work-center-ui";

// ============================================================
// مساحة المبيعات — ليست متتبّع مهام تقليدياً: العمل اليومي حول العميل
// والفرصة. كل بطاقة تفتح العميل والفرصة، وتتصل، وتسجّل نتيجة الاتصال
// (نفس نموذج CRM)، وتؤجّل المتابعة، وتنشئ مهمة جديدة على العميل.
//
// المصدر: مهام المساحة (قسمها في مساحة المبيعات) + متابعات العملاء
// (clients.follow_up_date) + الليدات الساخنة من CRM.
// ============================================================
export default async function SalesWorkspace({
  todayISO, myUserId,
}: { todayISO: string; myUserId: string }) {
  const supabase = await createClient();
  const ws = { workspace: "sales" };
  const lp = { workspace: "sales" };

  // الليدات الساخنة: RLS على clients تحصرها في نطاق القارئ
  const { data: hot } = await supabase
    .from("clients")
    .select("id, name, phone, stage, follow_up_date, last_contact_at")
    .eq("lead_temperature", "ساخن")
    .is("deleted_at", null)
    .not("stage", "in", '("بيع","فشل البيع")')
    .order("follow_up_date", { ascending: true, nullsFirst: false })
    .limit(8);
  const hotLeads = (hot ?? []) as { id: string; name: string; phone: string | null; stage: string | null; follow_up_date: string | null }[];

  const common = { todayISO, myUserId, variant: "sales" as const };

  return (
    <div className="space-y-7">
      <TaskSection {...common} title="اليوم" icon="today" tone="text-brand-800"
        payload={{ ...ws, bucket: "today" }} listParams={{ ...lp, bucket: "today" }} limit={12}
        empty="لا مهام مبيعات اليوم." />

      <TaskSection {...common} title="عملاء متأخرون" icon="warning" tone="text-red-700"
        payload={{ ...ws, bucket: "late" }} listParams={{ ...lp, bucket: "late" }} limit={10}
        empty="لا متأخرات — كل العملاء في موعدهم 👌" />

      <section><ClientFollowUps project="" params={{}} /></section>

      <div className="grid gap-7 xl:grid-cols-2">
        <TaskSection {...common} title="متابعات" icon="event_repeat"
          payload={{ ...ws, bucket: "open", task_type: ["follow_up"], sort: "due" }}
          listParams={{ ...lp, bucket: "open", type: "follow_up", sort: "due" }} limit={6} empty="لا متابعات مفتوحة." />
        <TaskSection {...common} title="مكالمات" icon="call"
          payload={{ ...ws, bucket: "open", task_type: ["call"], sort: "due" }}
          listParams={{ ...lp, bucket: "open", type: "call", sort: "due" }} limit={6} empty="لا مكالمات مجدولة." />
        <TaskSection {...common} title="اجتماعات" icon="groups"
          payload={{ ...ws, bucket: "open", task_type: ["meeting"], sort: "due" }}
          listParams={{ ...lp, bucket: "open", type: "meeting", sort: "due" }} limit={6} empty="لا اجتماعات." />
        <TaskSection {...common} title="زيارات" icon="directions_walk"
          payload={{ ...ws, bucket: "open", task_type: ["visit"], sort: "due" }}
          listParams={{ ...lp, bucket: "open", type: "visit", sort: "due" }} limit={6} empty="لا زيارات." />
        <TaskSection {...common} title="حجوزات" icon="real_estate_agent"
          payload={{ ...ws, bucket: "open", task_type: ["reservation"], sort: "due" }}
          listParams={{ ...lp, bucket: "open", type: "reservation", sort: "due" }} limit={6} empty="لا حجوزات قيد المتابعة." />
        <TaskSection {...common} title="إجراءات معلّقة" icon="pending_actions"
          payload={{ ...ws, bucket: "open", task_type: ["pending_action", "general"], sort: "due" }}
          listParams={{ ...lp, bucket: "open", type: "pending_action", sort: "due" }} limit={6} empty="لا إجراءات معلّقة." />
      </div>

      {/* الليدات الساخنة */}
      <section>
        <SectionTitle icon="local_fire_department" title="ليدات ساخنة" count={hotLeads.length} tone="text-red-700" />
        {hotLeads.length === 0 ? (
          <p className="text-sm text-gray-400">لا ليدات ساخنة في نطاقك.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {hotLeads.map((c) => (
              <li key={c.id} className="dash-card flex items-center justify-between gap-2 p-3">
                <div className="min-w-0">
                  <Link href={`/dashboard/clients/${c.id}`} className="font-semibold text-ink hover:text-brand-700">{c.name}</Link>
                  <p className="text-xs text-ink-muted">
                    {c.stage ?? "—"}{c.follow_up_date ? ` · متابعة ${c.follow_up_date}` : " · بلا موعد متابعة"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {c.phone && (
                    <a href={`tel:${c.phone}`} className="rounded-lg bg-brand-50 px-2 py-1 text-xs font-semibold text-brand-700" aria-label={`اتصل بـ ${c.name}`}>
                      <span aria-hidden="true" className="material-symbols-outlined text-[16px]">call</span>
                    </a>
                  )}
                  <Link href={`/dashboard/tasks/new?entity_type=client&entity_id=${c.id}&task_type=follow_up`}
                    className="rounded-lg bg-gray-50 px-2 py-1 text-xs font-semibold text-gray-700">+ مهمة</Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <TaskSection {...common} title="فرص خاسرة: استمارات وإعادة تواصل" icon="heart_broken" tone="text-red-800"
        payload={{ ...ws, bucket: "open", task_type: ["lost_analysis"], sort: "due" }}
        listParams={{ ...lp, bucket: "open", type: "lost_analysis", sort: "due" }} limit={6}
        empty="لا استمارات خسارة معلّقة." hint="تُنجَز مهمة الاستمارة وحدها عند حفظها." />
    </div>
  );
}
